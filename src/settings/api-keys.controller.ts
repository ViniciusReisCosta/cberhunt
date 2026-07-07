import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { ApiKey } from '../database/entities/api-key.entity';

@Controller('api-keys')
export class ApiKeysController {
  constructor(
    private readonly auth: AuthService,
    @InjectRepository(ApiKey)
    private readonly apiKeys: Repository<ApiKey>,
  ) {}

  @Get()
  async findAll(@Req() req: Request) {
    const user = await this.auth.requireAccess(req);
    if (!user.companyId) throw new BadRequestException('Company required');

    const keys = await this.apiKeys.find({
      where: { companyId: user.companyId },
      order: { createdAt: 'DESC' },
    });

    return keys.map((key) => this.serializeKey(key));
  }

  @Post()
  async create(@Req() req: Request, @Body() body: { name?: string }) {
    const user = await this.auth.requireAccess(req);
    if (user.role !== 'super_admin' && user.role !== 'company_admin') {
      throw new ForbiddenException('Forbidden');
    }
    if (!user.companyId) throw new BadRequestException('Company required');

    const name = body.name?.trim() || 'Default key';
    const token = `ck_${randomBytes(32).toString('hex')}`;
    const apiKey = this.apiKeys.create({
      name,
      keyPrefix: token.slice(0, 10),
      keyHash: bcrypt.hashSync(token, 12),
      active: true,
      companyId: user.companyId,
    });

    const saved = await this.apiKeys.save(apiKey);
    return { ...this.serializeKey(saved), token };
  }

  @Delete(':id')
  async revoke(@Req() req: Request, @Param('id') id: string) {
    const user = await this.auth.requireAccess(req);
    const existing = await this.apiKeys.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Not found');
    this.auth.ensureCompanyAccess(user, existing.companyId);

    await this.apiKeys.update({ id }, { active: false, revokedAt: new Date() });
    return { success: true };
  }

  private serializeKey(key: ApiKey) {
    return {
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      active: key.active,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
      revokedAt: key.revokedAt,
    };
  }
}

