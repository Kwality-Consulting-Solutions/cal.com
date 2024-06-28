import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, Validate } from "class-validator";

import { IsEmailStringOrArray } from "../validators/isEmailStringOrArray";

export class GetUsersInput {
  @IsOptional()
  @Validate(IsEmailStringOrArray)
  @ApiProperty({
    description: "The email address or an array of email addresses to filter by",
  })
  email?: string | string[];
}