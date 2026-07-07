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
import { ChatbotRule } from '../database/entities/chatbot-rule.entity';
import { User } from '../database/entities/user.entity';

@Controller('chatbot/rules')
export class ChatbotController {
  constructor(
    private readonly auth: AuthService,
    @InjectRepository(ChatbotRule)
    private readonly rules: Repository<ChatbotRule>,
  ) {}

  @Get()
  async findAll(@Req() req: Request, @Query('companyId') requestedCompanyId?: string) {
    const user = await this.auth.requireAccess(req);
    const companyId = this.getTargetCompanyId(user, requestedCompanyId);
    if (!companyId) throw new BadRequestException('Company required');
    this.auth.ensureCompanyAccess(user, companyId);

    return this.rules.find({
      where: { companyId },
      order: { keyword: 'ASC' },
    });
  }

  @Post()
  async create(
    @Req() req: Request,
    @Body() body: { keyword?: string; response?: string; active?: boolean; companyId?: string },
  ) {
    const user = await this.auth.requireAccess(req);
    const companyId = user.role === 'super_admin' && body.companyId ? body.companyId : user.companyId;
    if (!companyId) throw new BadRequestException('Company required');
    this.auth.ensureCompanyAccess(user, companyId);

    const keyword = body.keyword?.trim();
    const response = body.response?.trim();
    if (!keyword || !response) throw new BadRequestException('Keyword and response are required');

    const rule = this.rules.create({
      keyword,
      response,
      active: typeof body.active === 'boolean' ? body.active : true,
      companyId,
    });

    return this.rules.save(rule);
  }

  @Put(':id')
  async update(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const user = await this.auth.requireAccess(req);
    const existing = await this.rules.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Not found');
    this.auth.ensureCompanyAccess(user, existing.companyId);

    const updateData: Partial<ChatbotRule> = {};
    if (typeof body.keyword === 'string') updateData.keyword = body.keyword.trim();
    if (typeof body.response === 'string') updateData.response = body.response.trim();
    if (typeof body.active === 'boolean') updateData.active = body.active;
    if (Object.keys(updateData).length === 0) throw new BadRequestException('No allowed fields provided');

    await this.rules.update({ id }, updateData);
    return this.rules.findOneByOrFail({ id });
  }

  @Delete(':id')
  async delete(@Req() req: Request, @Param('id') id: string) {
    const user = await this.auth.requireAccess(req);
    const existing = await this.rules.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Not found');
    this.auth.ensureCompanyAccess(user, existing.companyId);

    await this.rules.delete({ id });
    return { success: true };
  }

  private getTargetCompanyId(user: User, requestedCompanyId?: string) {
    return user.role === 'super_admin' ? requestedCompanyId || user.companyId : user.companyId;
  }
}

