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
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { ILike, Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { Channel } from '../database/entities/channel.entity';
import { Company, PaymentStatus } from '../database/entities/company.entity';
import { Conversation } from '../database/entities/conversation.entity';
import { User } from '../database/entities/user.entity';

@Controller('companies')
export class CompaniesController {
  constructor(
    private readonly auth: AuthService,
    @InjectRepository(Company)
    private readonly companies: Repository<Company>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Conversation)
    private readonly conversations: Repository<Conversation>,
    @InjectRepository(Channel)
    private readonly channels: Repository<Channel>,
  ) {}

  @Get()
  async findAll(
    @Req() req: Request,
    @Query('search') search = '',
    @Query('status') status?: string,
  ) {
    const user = await this.auth.requireAccess(req);
    const where: Record<string, unknown> = {};

    if (user.role !== 'super_admin') {
      where.id = user.companyId;
    }
    if (search) {
      where.name = ILike(`%${search}%`);
    }
    if (status === 'active') where.active = true;
    if (status === 'inactive') where.active = false;

    const companies = await this.companies.find({
      where,
      order: { createdAt: 'DESC' },
    });

    return Promise.all(companies.map((company) => this.serializeCompany(company)));
  }

  @Post()
  async create(
    @Req() req: Request,
    @Body()
    body: {
      name?: string;
      email?: string;
      phone?: string | null;
      address?: string | null;
      plan?: string;
    },
  ) {
    const user = await this.auth.requireAccess(req);
    if (user.role !== 'super_admin') throw new ForbiddenException('Forbidden');

    const name = body.name?.trim();
    const email = body.email?.trim().toLowerCase();
    if (!name || !email) throw new BadRequestException('Name and email are required');

    const company = this.companies.create({
      name,
      email,
      phone: typeof body.phone === 'string' ? body.phone.trim() : null,
      address: typeof body.address === 'string' ? body.address.trim() : null,
      plan: typeof body.plan === 'string' ? body.plan : 'starter',
      paymentStatus: PaymentStatus.Pending,
      active: false,
    });

    return this.serializeCompany(await this.companies.save(company));
  }

  @Get(':id')
  async findOne(@Req() req: Request, @Param('id') id: string) {
    const user = await this.auth.requireAccess(req);
    this.auth.ensureCompanyAccess(user, id);

    const company = await this.companies.findOne({ where: { id } });
    if (!company) throw new NotFoundException('Not found');
    return this.serializeCompany(company, true);
  }

  @Put(':id')
  async update(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const user = await this.auth.requireAccess(req);
    this.auth.ensureCompanyAccess(user, id);

    if (user.role !== 'super_admin' && user.role !== 'company_admin') {
      throw new ForbiddenException('Forbidden');
    }

    const updateData: Partial<Company> = {};
    if (typeof body.name === 'string') updateData.name = body.name;
    if (typeof body.email === 'string') updateData.email = body.email.trim().toLowerCase();
    if (typeof body.phone === 'string' || body.phone === null) updateData.phone = body.phone;
    if (typeof body.address === 'string' || body.address === null) updateData.address = body.address;
    if (typeof body.welcomeMessage === 'string') updateData.welcomeMessage = body.welcomeMessage;
    if (typeof body.businessHoursStart === 'string') updateData.businessHoursStart = body.businessHoursStart;
    if (typeof body.businessHoursEnd === 'string') updateData.businessHoursEnd = body.businessHoursEnd;

    if (user.role === 'super_admin') {
      if (typeof body.plan === 'string') updateData.plan = body.plan;
      if (typeof body.active === 'boolean') updateData.active = body.active;
      if (
        typeof body.paymentStatus === 'string' &&
        Object.values(PaymentStatus).includes(body.paymentStatus as PaymentStatus)
      ) {
        updateData.paymentStatus = body.paymentStatus as PaymentStatus;
      }
    }

    if (Object.keys(updateData).length === 0) {
      throw new BadRequestException('No allowed fields provided');
    }

    const existing = await this.companies.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Not found');

    await this.companies.update({ id }, updateData);
    const updated = await this.companies.findOneOrFail({ where: { id } });
    return this.serializeCompany(updated, true);
  }

  @Delete(':id')
  async delete(@Req() req: Request, @Param('id') id: string) {
    const user = await this.auth.requireAccess(req);
    if (user.role !== 'super_admin') throw new ForbiddenException('Forbidden');
    await this.companies.delete({ id });
    return { success: true };
  }

  private async serializeCompany(company: Company, includeSettings = false) {
    const [users, conversations, channels] = await Promise.all([
      this.users.count({ where: { companyId: company.id } }),
      this.conversations.count({ where: { companyId: company.id } }),
      this.channels.count({ where: { companyId: company.id } }),
    ]);

    return {
      id: company.id,
      name: company.name,
      email: company.email,
      phone: company.phone,
      address: company.address,
      plan: company.plan,
      active: company.active,
      paymentStatus: company.paymentStatus,
      ...(includeSettings
        ? {
            businessHoursStart: company.businessHoursStart,
            businessHoursEnd: company.businessHoursEnd,
            welcomeMessage: company.welcomeMessage,
          }
        : {}),
      createdAt: company.createdAt,
      _count: { users, conversations, channels },
    };
  }
}

