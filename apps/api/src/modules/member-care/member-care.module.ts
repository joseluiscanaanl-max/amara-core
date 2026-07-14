import { Module } from '@nestjs/common';
import { MemberCareController } from './member-care.controller';
import { MemberCareService } from './member-care.service';
@Module({ controllers:[MemberCareController], providers:[MemberCareService] })
export class MemberCareModule {}
