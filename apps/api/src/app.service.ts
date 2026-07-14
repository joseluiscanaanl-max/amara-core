import { Injectable } from "@nestjs/common";

@Injectable()
export class AppService {
  health(): { status: string; service: string; version: string } {
    return {
      status: "ok",
      service: "amara-core-api",
      version: "0.1.0"
    };
  }
}