import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import bcrypt from 'bcryptjs';
import type { CookieOptions, Request } from 'express';
import jwt from 'jsonwebtoken';
import { Repository } from 'typeorm';
import { Company, PaymentStatus } from '../database/entities/company.entity';
import { User } from '../database/entities/user.entity';

export type JwtPayload = {
  userId: string;
  role: string;
  companyId: string | null;
};

export type SessionUser = {
  id: string;
  name: string;
  role: string;
  hasActiveAccess: boolean;
  company: {
    id: string;
    name: string;
    plan: string;
    active: boolean;
    paymentStatus: PaymentStatus;
  } | null;
};

type CookieRequest = Request & {
  cookies?: Record<string, string>;
};

@Injectable()
export class AuthService {
  private readonly sessionCookieName = 'cber_session';

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Company)
    private readonly companies: Repository<Company>,
  ) {}

  getSessionCookieName() {
    return this.sessionCookieName;
  }

  getSessionCookieOptions(maxAge = 60 * 60 * 12): CookieOptions {
    const configuredSameSite = (this.config.get<string>('SESSION_COOKIE_SAME_SITE') || 'lax').toLowerCase();
    const sameSite = configuredSameSite === 'none' || configuredSameSite === 'strict' ? configuredSameSite : 'lax';
    const secure = sameSite === 'none' || this.config.get('NODE_ENV') === 'production';

    return {
      httpOnly: true,
      secure,
      sameSite,
      path: '/',
      maxAge: maxAge * 1000,
    };
  }

  hashPassword(password: string) {
    return bcrypt.hashSync(password, 12);
  }

  comparePassword(password: string, hash: string) {
    return bcrypt.compareSync(password, hash);
  }

  signToken(payload: JwtPayload) {
    return jwt.sign(payload, this.getJwtSecret(), { expiresIn: '12h' });
  }

  verifyToken(token: string): JwtPayload | null {
    try {
      return jwt.verify(token, this.getJwtSecret()) as JwtPayload;
    } catch {
      return null;
    }
  }

  getTokenFromRequest(req: CookieRequest) {
    return req.cookies?.[this.sessionCookieName] || null;
  }

  getPayloadFromRequest(req: CookieRequest) {
    const token = this.getTokenFromRequest(req);
    if (!token) return null;
    return this.verifyToken(token);
  }

  async getAuthenticatedUser(req: CookieRequest) {
    const payload = this.getPayloadFromRequest(req);
    if (!payload) return null;

    return this.users.findOne({
      where: { id: payload.userId },
      relations: { company: true },
    });
  }

  async requireAccess(req: CookieRequest, options: { requirePayment?: boolean } = {}) {
    const user = await this.getAuthenticatedUser(req);
    const requirePayment = options.requirePayment ?? true;

    if (!user) {
      throw new UnauthorizedException('Unauthorized');
    }

    if (user.role !== 'super_admin' && !user.company) {
      throw new ForbiddenException('No company associated with this user');
    }

    if (
      user.role !== 'super_admin' &&
      user.company &&
      !user.company.active &&
      user.company.paymentStatus === PaymentStatus.Paid
    ) {
      throw new ForbiddenException('Your company account is deactivated');
    }

    if (requirePayment && !this.hasActivePaymentAccess(user)) {
      throw new HttpException(
        {
          error: 'Active payment required',
          code: 'PAYMENT_REQUIRED',
          paymentStatus: user.company?.paymentStatus ?? PaymentStatus.Pending,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    return user;
  }

  hasActivePaymentAccess(user: User | null) {
    if (!user) return false;
    if (user.role === 'super_admin') return true;
    if (!user.company) return false;
    return user.company.active && user.company.paymentStatus === PaymentStatus.Paid;
  }

  canAccessCompany(user: User, companyId: string) {
    if (user.role === 'super_admin') return true;
    return user.companyId === companyId;
  }

  ensureCompanyAccess(user: User, companyId: string) {
    if (!this.canAccessCompany(user, companyId)) {
      throw new ForbiddenException('Forbidden');
    }
  }

  serializeSessionUser(user: User): SessionUser {
    return {
      id: user.id,
      name: user.name,
      role: user.role,
      hasActiveAccess: this.hasActivePaymentAccess(user),
      company: user.company
        ? {
            id: user.company.id,
            name: user.company.name,
            plan: user.company.plan,
            active: user.company.active,
            paymentStatus: user.company.paymentStatus,
          }
        : null,
    };
  }

  async findUserForLogin(email: string) {
    return this.users.findOne({
      where: { email: email.trim().toLowerCase() },
      relations: { company: true },
    });
  }

  async createCompany(name: string, email: string) {
    const company = this.companies.create({
      name,
      email,
      active: false,
      paymentStatus: PaymentStatus.Pending,
    });
    return this.companies.save(company);
  }

  private getJwtSecret() {
    const secret = this.config.get<string>('JWT_SECRET') || 'cberhunt-fallback-secret';

    if (this.config.get('NODE_ENV') === 'production' && secret === 'cberhunt-fallback-secret') {
      throw new InternalServerErrorException('JWT_SECRET must be configured in production');
    }

    return secret;
  }
}
