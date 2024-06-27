import { createHmac } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";

import {
  getDownloadLinkOfCalVideoByRecordingId,
  submitBatchProcessorTranscriptionJob,
} from "@calcom/core/videoClient";
import { getAllTranscriptsAccessLinkFromRoomName } from "@calcom/core/videoClient";
import { sendDailyVideoRecordingEmails } from "@calcom/emails";
import { sendDailyVideoTranscriptEmails } from "@calcom/emails";
import { getTeamIdFromEventType } from "@calcom/lib/getTeamIdFromEventType";
import logger from "@calcom/lib/logger";
import { safeStringify } from "@calcom/lib/safeStringify";
import { defaultHandler } from "@calcom/lib/server";
import prisma from "@calcom/prisma";
import { getBooking } from "@calcom/web/lib/daily-webhook/getBooking";
import { getBookingReference } from "@calcom/web/lib/daily-webhook/getBookingReference";
import { getCalendarEvent } from "@calcom/web/lib/daily-webhook/getCalendarEvent";
import {
  meetingEndedSchema,
  recordingReadySchema,
  batchProcessorJobFinishedSchema,
  downloadLinkSchema,
  testRequestSchema,
} from "@calcom/web/lib/daily-webhook/schema";
import { triggerRecordingReadyWebhook } from "@calcom/web/lib/daily-webhook/triggerRecordingReadyWebhook";

const log = logger.getSubLogger({ prefix: ["daily-video-webhook-handler"] });

const computeSignature = (
  hmacSecret: string,
  reqBody: NextApiRequest["body"],
  webhookTimestampHeader: string
) => {
  const signature = `${webhookTimestampHeader}.${JSON.stringify(reqBody)}`;
  const base64DecodedSecret = Buffer.from(hmacSecret, "base64");
  const hmac = createHmac("sha256", base64DecodedSecret);
  const computed_signature = hmac.update(signature).digest("base64");
  return computed_signature;
};

const getDownloadLinkOfCalVideo = async (recordingId: string) => {
  const response = await getDownloadLinkOfCalVideoByRecordingId(recordingId);
  const downloadLinkResponse = downloadLinkSchema.parse(response);
  const downloadLink = downloadLinkResponse.download_link;
  return downloadLink;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_EMAIL) {
    return res.status(405).json({ message: "No SendGrid API key or email" });
  }

  if (testRequestSchema.safeParse(req.body).success) {
    return res.status(200).json({ message: "Test request successful" });
  }

  const hmacSecret = process.env.DAILY_WEBHOOK_SECRET;
  if (!hmacSecret) {
    return res.status(405).json({ message: "No Daily Webhook Secret" });
  }

  const computed_signature = computeSignature(hmacSecret, req.body, req.headers["x-webhook-timestamp"]);

  if (req.headers["x-webhook-signature"] !== computed_signature) {
    return res.status(403).json({ message: "Signature does not match" });
  }

  log.debug(
    "Daily video webhook Request Body:",
    safeStringify({
      body: req.body,
    })
  );

  try {
    if (req.body?.type === "recording.ready-to-download") {
      const recordingReadyResponse = recordingReadySchema.safeParse(req.body);

      if (!recordingReadyResponse.success) {
        return res.status(400).send({
          message: "Invalid Payload",
        });
      }

      const { room_name, recording_id, status } = recordingReadyResponse.data.payload;

      if (status !== "finished") {
        return res.status(400).send({
          message: "Recording not finished",
        });
      }
      const bookingReference = await getBookingReference(room_name);

      if (!bookingReference || !bookingReference.bookingId) {
        return res.status(200).send({ message: "Booking reference not found" });
      }

      const booking = await getBooking(bookingReference.bookingId);

      if (!booking) {
        return res.status(404).send({
          message: `Booking of room_name ${room_name} does not exist or does not contain daily video as location`,
        });
      }

      const evt = await getCalendarEvent(booking);

      await prisma.booking.update({
        where: {
          uid: booking.uid,
        },
        data: {
          isRecorded: true,
        },
      });

      const downloadLink = await getDownloadLinkOfCalVideo(recording_id);

      const teamId = await getTeamIdFromEventType({
        eventType: {
          team: { id: booking?.eventType?.teamId ?? null },
          parentId: booking?.eventType?.parentId ?? null,
        },
      });

      await triggerRecordingReadyWebhook({
        evt,
        downloadLink,
        booking: {
          userId: booking?.user?.id,
          eventTypeId: booking.eventTypeId,
          eventTypeParentId: booking.eventType?.parentId,
          teamId,
        },
      });

      try {
        // Submit Transcription Batch Processor Job
        await submitBatchProcessorTranscriptionJob(recording_id);
      } catch (err) {
        log.error("Failed to  Submit Transcription Batch Processor Job:", safeStringify(err));
      }

      // send emails to all attendees only when user has team plan
      await sendDailyVideoRecordingEmails(evt, downloadLink);
      return res.status(200).json({ message: "Success" });
    } else if (req.body.type === "meeting.ended") {
      const meetingEndedResponse = meetingEndedSchema.safeParse(req.body);
      if (!meetingEndedResponse.success) {
        return res.status(400).send({
          message: "Invalid Payload",
        });
      }

      const { room } = meetingEndedResponse.data.payload;

      const bookingReference = await getBookingReference(room);
      if (!bookingReference || !bookingReference.bookingId) {
        return res.status(200).send({ message: "Booking reference not found" });
      }

      const booking = await getBooking(bookingReference.bookingId);

      if (!booking) {
        return res.status(404).send({
          message: `Booking of room_name ${room} does not exist or does not contain daily video as location`,
        });
      }

      const transcripts = await getAllTranscriptsAccessLinkFromRoomName(room);

      if (!transcripts || !transcripts.length)
        return res.status(200).json({ message: `No Transcripts found for room name ${room}` });

      const evt = await getCalendarEvent(booking);
      await sendDailyVideoTranscriptEmails(evt, transcripts);

      return res.status(200).json({ message: "Success" });
    } else if (req.body?.type === "batch-processor.job-finished") {
      console.log("Batch Processor Job Finished");
      const batchProcessorJobFinishedResponse = batchProcessorJobFinishedSchema.safeParse(req.body);

      if (!batchProcessorJobFinishedResponse.success) {
        return res.status(400).send({
          message: "Invalid Payload",
        });
      }

      const { id, status, input, output } = batchProcessorJobFinishedResponse.data.payload;
      // TODO: get booking from roomName/recordingId and then trigger webhook
      return res.status(200).json({ message: "Success" });
    }
  } catch (err) {
    log.error("Error in /recorded-daily-video", err);
    return res.status(500).json({ message: "something went wrong" });
  }
}

export default defaultHandler({
  POST: Promise.resolve({ default: handler }),
});
