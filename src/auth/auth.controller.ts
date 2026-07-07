import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request, Response } from 'express';
import { DataSource, Repository } from 'typeorm';
import { Company, PaymentStatus } from '../database/entities/company.entity';
import { User } from '../database/entities/user.entity';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly dataSource: DataSource,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  @Post('login')
  async login(
    @Body() body: { email?: string; password?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const email = body.email?.trim().toLowerCase();
    const password = body.password;

    if (!email || !password) {
      throw new BadRequestException('Email and password are required');
    }

    const user = await this.auth.findUserForLogin(email);
    if (!user || !this.auth.comparePassword(password, user.password)) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (
      user.company &&
      !user.company.active &&
      user.company.paymentStatus === PaymentStatus.Paid &&
      user.role !== 'super_admin'
    ) {
      throw new ForbiddenException('Your company account is deactivated');
    }

    const token = this.auth.signToken({
      userId: user.id,
      role: user.role,
      companyId: user.companyId,
    });

    await this.users.update({ id: user.id }, { online: true });
    res.cookie(this.auth.getSessionCookieName(), token, this.auth.getSessionCookieOptions());

    const hasDashboardAccess = user.role === 'super_admin' || user.company?.paymentStatus === PaymentStatus.Paid;

    return {
      nextStep: hasDashboardAccess ? 'dashboard' : 'payment',
      paymentRequired: user.role !== 'super_admin' && user.company?.paymentStatus !== PaymentStatus.Paid,
      user: this.auth.serializeSessionUser(user),
    };
  }

  @Post('register')
  async register(
    @Body() body: { name?: string; email?: string; password?: string; companyName?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const name = body.name?.trim();
    const email = body.email?.trim().toLowerCase();
    const password = body.password;
    const companyName = body.companyName?.trim();

    if (!name || !email || !password) {
      throw new BadRequestException('Name, email, and password are required');
    }
    if (!companyName) {
      throw new BadRequestException('Company name is required to create your workspace');
    }

    const existing = await this.users.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const user = await this.dataSource.transaction(async (manager) => {
      const companyRepo = manager.getRepository(Company);
      const userRepo = manager.getRepository(User);

      const company = companyRepo.create({
        name: companyName,
        email,
        active: false,
        paymentStatus: PaymentStatus.Pending,
      });
      await companyRepo.save(company);

      const created = userRepo.create({
        name,
        email,
        password: this.auth.hashPassword(password),
        role: 'company_admin',
        companyId: company.id,
        company,
        online: true,
      });
      return userRepo.save(created);
    });

    const token = this.auth.signToken({
      userId: user.id,
      role: user.role,
      companyId: user.companyId,
    });

    res.cookie(this.auth.getSessionCookieName(), token, this.auth.getSessionCookieOptions());

    return {
      nextStep: user.company?.paymentStatus === PaymentStatus.Paid ? 'dashboard' : 'payment',
      paymentRequired: user.company?.paymentStatus !== PaymentStatus.Paid,
      user: this.auth.serializeSessionUser(user),
    };
  }

  @Get('me')
  async me(@Req() req: Request) {
    const user = await this.auth.requireAccess(req, { requirePayment: false });
    return this.auth.serializeSessionUser(user);
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.getAuthenticatedUser(req);
    if (user) {
      await this.users.update({ id: user.id }, { online: false });
    }

    res.cookie(this.auth.getSessionCookieName(), '', this.auth.getSessionCookieOptions(0));
    return { success: true };
  }
}
