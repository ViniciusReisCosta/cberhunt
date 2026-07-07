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
  Req,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { QuickReply } from '../database/entities/quick-reply.entity';

@Controller('quick-replies')
export class QuickRepliesController {
  constructor(
    private readonly auth: AuthService,
    @InjectRepository(QuickReply)
    private readonly replies: Repository<QuickReply>,
  ) {}

  @Get()
  async findAll(@Req() req: Request) {
    const user = await this.auth.requireAccess(req);
    if (!user.companyId) throw new BadRequestException('Company required');

    return this.replies.find({
      where: { companyId: user.companyId, active: true },
      order: { createdAt: 'ASC' },
    });
  }

  @Post()
  async create(@Req() req: Request, @Body() body: { text?: string; active?: boolean }) {
    const user = await this.auth.requireAccess(req);
    if (!user.companyId) throw new BadRequestException('Company required');

    const text = body.text?.trim();
    if (!text) throw new BadRequestException('Text is required');

    const reply = this.replies.create({
      text,
      active: typeof body.active === 'boolean' ? body.active : true,
      companyId: user.companyId,
    });
    return this.replies.save(reply);
  }

  @Put(':id')
  async update(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const user = await this.auth.requireAccess(req);
    const existing = await this.replies.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Not found');
    this.auth.ensureCompanyAccess(user, existing.companyId);

    const updateData: Partial<QuickReply> = {};
    if (typeof body.text === 'string') updateData.text = body.text.trim();
    if (typeof body.active === 'boolean') updateData.active = body.active;
    await this.replies.update({ id }, updateData);
    return this.replies.findOneByOrFail({ id });
  }

  @Delete(':id')
  async delete(@Req() req: Request, @Param('id') id: string) {
    const user = await this.auth.requireAccess(req);
    const existing = await this.replies.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Not found');
    this.auth.ensureCompanyAccess(user, existing.companyId);

    await this.replies.delete({ id });
    return { success: true };
  }
}

