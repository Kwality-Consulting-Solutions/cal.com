import logger from "@calcom/lib/logger";
import { safeStringify } from "@calcom/lib/safeStringify";
import prisma from "@calcom/prisma";

const log = logger.getSubLogger({ prefix: ["daily-video-webhook-handler"] });

export const getBookingReference = async (roomName: string) => {
  const bookingReference = await prisma.bookingReference.findFirst({
    where: { type: "daily_video", uid: roomName, meetingId: roomName },
    select: { bookingId: true },
  });

  if (!bookingReference || !bookingReference.bookingId) {
    log.error(
      "bookingReference not found error:",
      safeStringify({
        bookingReference,
        roomName,
      })
    );
  }

  return bookingReference;
};
