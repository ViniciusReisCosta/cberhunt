import { BadRequestException, Controller, Get, Req } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { Invoice } from '../database/entities/invoice.entity';

@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly auth: AuthService,
    @InjectRepository(Invoice)
    private readonly invoices: Repository<Invoice>,
  ) {}

  @Get()
  async findAll(@Req() req: Request) {
    const user = await this.auth.requireAccess(req);
    if (!user.companyId) throw new BadRequestException('Company required');

    return this.invoices.find({
      where: { companyId: user.companyId },
      order: { createdAt: 'DESC' },
    });
  }
}

