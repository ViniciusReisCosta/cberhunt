import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
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
  private readonly logger = new Logger(AuthService.name);
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

  verifyTokenWithReason(token: string): { payload: JwtPayload | null; error: string | null } {
    try {
      return { payload: jwt.verify(token, this.getJwtSecret()) as JwtPayload, error: null };
    } catch (error) {
      return {
        payload: null,
        error: error instanceof Error ? error.message : 'Invalid token',
      };
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
    const token = this.getTokenFromRequest(req);
    const shouldLogSubscribeAuth = this.shouldLogSubscribeAuth(req);

    if (shouldLogSubscribeAuth) {
      this.logger.log(
        `POST /api/payments/subscribe auth request ${JSON.stringify({
          originalUrl: req.originalUrl,
          method: req.method,
          cookieName: this.sessionCookieName,
          cookieKeys: Object.keys(req.cookies ?? {}),
          hasSessionCookie: Boolean(token),
          sessionCookie: this.maskSensitiveValue(token),
          authorization: this.maskSensitiveValue(req.headers.authorization),
          origin: req.headers.origin ?? null,
          referer: req.headers.referer ?? null,
          userAgent: req.headers['user-agent'] ?? null,
        })}`,
      );
    }

    let payload: JwtPayload | null = null;
    if (!token) {
      if (shouldLogSubscribeAuth) {
        this.logger.warn(
          `POST /api/payments/subscribe unauthorized: missing session cookie ${JSON.stringify({
            expectedCookie: this.sessionCookieName,
            cookieKeys: Object.keys(req.cookies ?? {}),
            rawCookieHeader: this.maskSensitiveValue(req.headers.cookie),
          })}`,
        );
      }
    } else {
      const verified = this.verifyTokenWithReason(token);
      payload = verified.payload;

      if (!payload && shouldLogSubscribeAuth) {
        this.logger.warn(
          `POST /api/payments/subscribe unauthorized: invalid session token ${JSON.stringify({
            reason: verified.error,
            expectedCookie: this.sessionCookieName,
            sessionCookie: this.maskSensitiveValue(token),
          })}`,
        );
      }
    }

    const user = payload
      ? await this.users.findOne({
          where: { id: payload.userId },
          relations: { company: true },
        })
      : null;
    const requirePayment = options.requirePayment ?? true;

    if (!user) {
      if (payload && shouldLogSubscribeAuth) {
        this.logger.warn(
          `POST /api/payments/subscribe unauthorized: token user not found ${JSON.stringify({
            userId: payload.userId,
            role: payload.role,
            companyId: payload.companyId,
          })}`,
        );
      }
      throw new UnauthorizedException('Unauthorized');
    }

    if (shouldLogSubscribeAuth) {
      this.logger.log(
        `POST /api/payments/subscribe authenticated user ${JSON.stringify({
          userId: user.id,
          role: user.role,
          companyId: user.companyId,
          hasCompany: Boolean(user.company),
          companyActive: user.company?.active ?? null,
          companyPaymentStatus: user.company?.paymentStatus ?? null,
          requirePayment,
        })}`,
      );
    }

    if (user.role !== 'super_admin' && !user.company) {
      if (shouldLogSubscribeAuth) {
        this.logger.warn(
          `POST /api/payments/subscribe forbidden: no company ${JSON.stringify({
            userId: user.id,
            role: user.role,
            companyId: user.companyId,
          })}`,
        );
      }
      throw new ForbiddenException('No company associated with this user');
    }

    if (
      user.role !== 'super_admin' &&
      user.company &&
      !user.company.active &&
      user.company.paymentStatus === PaymentStatus.Paid
    ) {
      if (shouldLogSubscribeAuth) {
        this.logger.warn(
          `POST /api/payments/subscribe forbidden: paid company inactive ${JSON.stringify({
            userId: user.id,
            role: user.role,
            companyId: user.companyId,
            companyActive: user.company.active,
            companyPaymentStatus: user.company.paymentStatus,
          })}`,
        );
      }
      throw new ForbiddenException('Your company account is deactivated');
    }

    if (requirePayment && !this.hasActivePaymentAccess(user)) {
      if (shouldLogSubscribeAuth) {
        this.logger.warn(
          `POST /api/payments/subscribe payment required ${JSON.stringify({
            userId: user.id,
            role: user.role,
            companyId: user.companyId,
            companyActive: user.company?.active ?? null,
            companyPaymentStatus: user.company?.paymentStatus ?? PaymentStatus.Pending,
          })}`,
        );
      }
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

  private shouldLogSubscribeAuth(req: CookieRequest) {
    return req.method === 'POST' && (req.originalUrl ?? req.path ?? '').includes('/api/payments/subscribe');
  }

  private maskSensitiveValue(value: unknown) {
    if (typeof value !== 'string') return value ? '[present]' : value;
    if (!value) return value;
    if (value.length <= 12) return `[present:${value.length}]`;
    return `${value.slice(0, 6)}...${value.slice(-4)} [len:${value.length}]`;
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
