import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { DataSource, In, Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { Conversation } from '../database/entities/conversation.entity';
import { Message } from '../database/entities/message.entity';
import { User } from '../database/entities/user.entity';

@Controller('agents')
export class AgentsController {
  constructor(
    private readonly auth: AuthService,
    private readonly dataSource: DataSource,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Conversation)
    private readonly conversations: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messages: Repository<Message>,
  ) {}

  @Get()
  async findAll(@Req() req: Request, @Query('companyId') requestedCompanyId?: string) {
    const user = await this.auth.requireAccess(req);
    const where: Record<string, unknown> = {
      role: In(['agent', 'company_admin', 'admin']),
    };

    if (user.role === 'super_admin' && requestedCompanyId) {
      where.companyId = requestedCompanyId;
    } else if (user.companyId) {
      where.companyId = user.companyId;
    }

    const agents = await this.users.find({
      where,
      relations: { company: true },
      order: { name: 'ASC' },
    });

    return Promise.all(agents.map((agent) => this.serializeAgent(agent)));
  }

  @Post()
  async create(
    @Req() req: Request,
    @Body() body: { name?: string; email?: string; password?: string; role?: string; companyId?: string },
  ) {
    const user = await this.auth.requireAccess(req);
    if (user.role !== 'super_admin' && user.role !== 'company_admin') {
      throw new ForbiddenException('Forbidden');
    }

    const companyId = user.role === 'super_admin' && body.companyId ? body.companyId : user.companyId;
    if (!companyId) throw new BadRequestException('Company required');
    this.auth.ensureCompanyAccess(user, companyId);

    const name = body.name?.trim();
    const email = body.email?.trim().toLowerCase();
    const password = body.password;
    const role = body.role && ['agent', 'company_admin'].includes(body.role) ? body.role : 'agent';

    if (!name || !email || !password) {
      throw new BadRequestException('Name, email, and password are required');
    }

    const existing = await this.users.findOne({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');

    const agent = this.users.create({
      name,
      email,
      password: this.auth.hashPassword(password),
      role,
      companyId,
    });

    return this.serializeAgent(await this.users.save(agent));
  }

  @Get(':id')
  async findOne(@Req() req: Request, @Param('id') id: string) {
    const user = await this.auth.requireAccess(req);
    const agent = await this.users.findOne({ where: { id }, relations: { company: true } });
    if (!agent) throw new BadRequestException('Not found');
    if (agent.companyId) this.auth.ensureCompanyAccess(user, agent.companyId);
    return this.serializeAgent(agent);
  }

  @Put(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const user = await this.auth.requireAccess(req);
    const target = await this.users.findOne({ where: { id }, relations: { company: true } });
    if (!target) throw new BadRequestException('Not found');
    if (target.companyId) this.auth.ensureCompanyAccess(user, target.companyId);
    if (user.role !== 'super_admin' && target.role === 'super_admin') {
      throw new ForbiddenException('Forbidden');
    }

    const updateData: Partial<User> = {};
    if (typeof body.name === 'string') updateData.name = body.name;
    if (typeof body.email === 'string') updateData.email = body.email.trim().toLowerCase();
    if (typeof body.avatar === 'string' || body.avatar === null) updateData.avatar = body.avatar;
    if (typeof body.online === 'boolean') updateData.online = body.online;
    if (typeof body.role === 'string') {
      if (user.role !== 'super_admin' && user.role !== 'company_admin') {
        throw new ForbiddenException('Forbidden');
      }
      updateData.role = body.role;
    }

    if (Object.keys(updateData).length === 0) {
      throw new BadRequestException('No allowed fields provided');
    }

    await this.users.update({ id }, updateData);
    const updated = await this.users.findOneOrFail({ where: { id }, relations: { company: true } });
    return this.serializeAgent(updated);
  }

  @Delete(':id')
  async delete(@Req() req: Request, @Param('id') id: string) {
    const user = await this.auth.requireAccess(req);
    const target = await this.users.findOne({ where: { id } });
    if (!target) throw new BadRequestException('Not found');
    if (target.companyId) this.auth.ensureCompanyAccess(user, target.companyId);

    if (target.role === 'super_admin' || (user.role !== 'super_admin' && user.role !== 'company_admin')) {
      throw new ForbiddenException('Forbidden');
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.update(Conversation, { agentId: id }, { agentId: null });
      await manager.update(Message, { senderId: id }, { senderId: null });
      await manager.delete(User, { id });
    });

    return { success: true };
  }

  private async serializeAgent(agent: User) {
    const [assignedConversations, messageCount] = await Promise.all([
      this.conversations.count({ where: { agentId: agent.id } }),
      this.messages.count({ where: { senderId: agent.id } }),
    ]);

    return {
      id: agent.id,
      name: agent.name,
      email: agent.email,
      role: agent.role,
      online: agent.online,
      avatar: agent.avatar,
      companyId: agent.companyId,
      company: agent.company ? { id: agent.company.id, name: agent.company.name } : null,
      _count: {
        assignedConversations,
        messages: messageCount,
      },
    };
  }
}

