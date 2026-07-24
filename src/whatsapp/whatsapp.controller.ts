import { Body, Controller, ForbiddenException, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { WhatsAppService, type WhatsAppWebhookPayload } from './whatsapp.service';

@Controller('whatsapp/webhook')
export class WhatsAppController {
  constructor(private readonly whatsapp: WhatsAppService) {}

  @Get()
  verify(
    @Res() res: Response,
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ) {
    const verifiedChallenge = this.whatsapp.verifyWebhook(mode, token, challenge);
    if (!verifiedChallenge) throw new ForbiddenException('Invalid webhook verification token');
    return res.status(200).send(verifiedChallenge);
  }

  @Post()
  handle(@Body() body: WhatsAppWebhookPayload) {
    return this.whatsapp.handleWebhook(body);
  }
}
