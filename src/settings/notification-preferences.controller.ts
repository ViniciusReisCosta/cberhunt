import { BadRequestException, Body, Controller, Get, Put, Req } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { NotificationPreference } from '../database/entities/notification-preference.entity';

@Controller('notification-preferences')
export class NotificationPreferencesController {
  constructor(
    private readonly auth: AuthService,
    @InjectRepository(NotificationPreference)
    private readonly preferences: Repository<NotificationPreference>,
  ) {}

  @Get()
  async get(@Req() req: Request) {
    const user = await this.auth.requireAccess(req);
    if (!user.companyId) throw new BadRequestException('Company required');
    return this.findOrCreate(user.companyId);
  }

  @Put()
  async update(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const user = await this.auth.requireAccess(req);
    if (!user.companyId) throw new BadRequestException('Company required');

    const existing = await this.findOrCreate(user.companyId);
    const data: Partial<NotificationPreference> = {};

    for (const key of [
      'emailNotifications',
      'browserNotifications',
      'newMessageAlerts',
      'assignmentAlerts',
      'paymentReminders',
    ] as const) {
      if (typeof body[key] === 'boolean') data[key] = body[key];
    }

    await this.preferences.update({ id: existing.id }, data);
    return this.preferences.findOneByOrFail({ id: existing.id });
  }

  private async findOrCreate(companyId: string) {
    const existing = await this.preferences.findOne({ where: { companyId } });
    if (existing) return existing;
    return this.preferences.save(this.preferences.create({ companyId }));
  }
}

