import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { ChannelType } from '../database/entities/channel-type.entity';
import { Channel } from '../database/entities/channel.entity';
import { Conversation } from '../database/entities/conversation.entity';

@Controller()
export class ChannelsController {
  constructor(
    private readonly auth: AuthService,
    @InjectRepository(Channel)
    private readonly channels: Repository<Channel>,
    @InjectRepository(ChannelType)
    private readonly channelTypes: Repository<ChannelType>,
    @InjectRepository(Conversation)
    private readonly conversations: Repository<Conversation>,
  ) {}

  @Get('channel-types')
  findTypes() {
    return this.channelTypes.find({
      where: { active: true },
      order: { sortOrder: 'ASC', label: 'ASC' },
    });
  }

  @Get('channels')
  async findAll(@Req() req: Request, @Query('companyId') requestedCompanyId?: string) {
    const user = await this.auth.requireAccess(req);
    const companyId = user.role === 'super_admin' ? requestedCompanyId || null : user.companyId;

    if (!companyId && user.role !== 'super_admin') {
      throw new BadRequestException('No company available');
    }
    if (companyId) this.auth.ensureCompanyAccess(user, companyId);

    const channels = await this.channels.find({
      where: companyId ? { companyId } : {},
      relations: { company: true },
      order: { createdAt: 'DESC' },
    });

    return Promise.all(channels.map((channel) => this.serializeChannel(channel)));
  }

  @Post('channels')
  async create(
    @Req() req: Request,
    @Body()
    body: {
      type?: string;
      name?: string;
      accountId?: string | null;
      accessToken?: string | null;
      connected?: boolean;
      companyId?: string;
    },
  ) {
    const user = await this.auth.requireAccess(req);
    const companyId = user.role === 'super_admin' && body.companyId ? body.companyId : user.companyId;
    if (!companyId) throw new BadRequestException('Company required');
    this.auth.ensureCompanyAccess(user, companyId);

    const type = body.type?.trim();
    const name = body.name?.trim();
    if (!type || !name) throw new BadRequestException('Type and name are required');

    const channelType = await this.channelTypes.findOne({ where: { type, active: true } });
    if (!channelType) throw new BadRequestException('Invalid channel type');

    const channel = this.channels.create({
      type,
      name,
      accountId: typeof body.accountId === 'string' ? body.accountId.trim() : null,
      accessToken: typeof body.accessToken === 'string' ? body.accessToken.trim() : null,
      connected: typeof body.connected === 'boolean' ? body.connected : false,
      companyId,
    });

    return this.serializeChannel(await this.channels.save(channel));
  }

  @Put('channels/:id')
  async update(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const user = await this.auth.requireAccess(req);
    const existing = await this.channels.findOne({ where: { id }, relations: { company: true } });
    if (!existing) throw new NotFoundException('Not found');
    this.auth.ensureCompanyAccess(user, existing.companyId);

    const updateData: Partial<Channel> = {};
    if (typeof body.name === 'string') updateData.name = body.name;
    if (typeof body.accountId === 'string' || body.accountId === null) updateData.accountId = body.accountId;
    if (typeof body.accessToken === 'string' || body.accessToken === null) updateData.accessToken = body.accessToken;
    if (typeof body.connected === 'boolean') updateData.connected = body.connected;

    await this.channels.update({ id }, updateData);
    const updated = await this.channels.findOneOrFail({ where: { id }, relations: { company: true } });
    return this.serializeChannel(updated);
  }

  @Delete('channels/:id')
  async delete(@Req() req: Request, @Param('id') id: string) {
    const user = await this.auth.requireAccess(req);
    const existing = await this.channels.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Not found');
    this.auth.ensureCompanyAccess(user, existing.companyId);

    await this.channels.delete({ id });
    return { success: true };
  }

  private async serializeChannel(channel: Channel) {
    const conversations = await this.conversations.count({ where: { channelId: channel.id } });

    return {
      id: channel.id,
      type: channel.type,
      name: channel.name,
      accountId: channel.accountId,
      connected: channel.connected,
      companyId: channel.companyId,
      company: channel.company ? { id: channel.company.id, name: channel.company.name } : null,
      createdAt: channel.createdAt,
      _count: { conversations },
    };
  }
}

