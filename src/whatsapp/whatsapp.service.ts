import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Channel } from '../database/entities/channel.entity';
import { ChatbotRule } from '../database/entities/chatbot-rule.entity';
import { Company } from '../database/entities/company.entity';
import { Conversation } from '../database/entities/conversation.entity';
import { Message } from '../database/entities/message.entity';
import { User } from '../database/entities/user.entity';

export type WhatsAppWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: {
          phone_number_id?: string;
          display_phone_number?: string;
        };
        contacts?: WhatsAppContact[];
        messages?: WhatsAppIncomingMessage[];
        statuses?: Array<{
          id?: string;
          status?: string;
          recipient_id?: string;
          timestamp?: string;
        }>;
      };
    }>;
  }>;
};

type WhatsAppContact = {
  wa_id?: string;
  profile?: { name?: string };
};

type WhatsAppIncomingMessage = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
};

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Channel)
    private readonly channels: Repository<Channel>,
    @InjectRepository(Conversation)
    private readonly conversations: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messages: Repository<Message>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Company)
    private readonly companies: Repository<Company>,
    @InjectRepository(ChatbotRule)
    private readonly chatbotRules: Repository<ChatbotRule>,
  ) {}

  verifyWebhook(mode?: string, token?: string, challenge?: string) {
    const expectedToken = this.config.get<string>('WHATSAPP_WEBHOOK_VERIFY_TOKEN')?.trim();
    if (!expectedToken) {
      this.logger.warn('WhatsApp webhook verification failed: WHATSAPP_WEBHOOK_VERIFY_TOKEN is not configured');
      return null;
    }

    if (mode === 'subscribe' && token === expectedToken && challenge) {
      return challenge;
    }

    this.logger.warn(
      `WhatsApp webhook verification rejected ${JSON.stringify({
        mode,
        hasToken: Boolean(token),
        hasChallenge: Boolean(challenge),
      })}`,
    );
    return null;
  }

  async handleWebhook(payload: WhatsAppWebhookPayload) {
    const changes = payload.entry?.flatMap((entry) => entry.changes ?? []) ?? [];

    for (const change of changes) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;

      for (const status of value?.statuses ?? []) {
        this.logger.log(
          `WhatsApp message status ${JSON.stringify({
            phoneNumberId,
            messageId: status.id,
            status: status.status,
            recipientId: this.maskPhone(status.recipient_id),
          })}`,
        );
      }

      for (const message of value?.messages ?? []) {
        try {
          await this.handleIncomingMessage(phoneNumberId, value?.contacts ?? [], message);
        } catch (error) {
          this.logger.error(
            `WhatsApp incoming message processing failed ${JSON.stringify({
              phoneNumberId,
              messageId: message.id,
              from: this.maskPhone(message.from),
              message: error instanceof Error ? error.message : String(error),
            })}`,
          );
        }
      }
    }

    return { received: true };
  }

  async sendConversationText(conversation: Conversation, content: string) {
    if (conversation.channel !== 'whatsapp') return;
    if (!conversation.customerPhone) {
      throw new BadRequestException('WhatsApp conversation does not have a customer phone');
    }

    const channel = await this.resolveConversationChannel(conversation);
    this.assertCanSend(channel);
    await this.sendTextMessage(channel, conversation.customerPhone, content);
  }

  private async handleIncomingMessage(
    phoneNumberId: string | undefined,
    contacts: WhatsAppContact[],
    message: WhatsAppIncomingMessage,
  ) {
    if (!phoneNumberId) {
      this.logger.warn('WhatsApp incoming message ignored: missing phone_number_id');
      return;
    }

    if (!message.from) {
      this.logger.warn(`WhatsApp incoming message ignored: missing sender ${JSON.stringify({ phoneNumberId, messageId: message.id })}`);
      return;
    }

    const channel = await this.channels.findOne({
      where: { type: 'whatsapp', accountId: phoneNumberId, connected: true },
    });

    if (!channel) {
      this.logger.warn(
        `WhatsApp incoming message ignored: channel not found ${JSON.stringify({
          phoneNumberId,
          from: this.maskPhone(message.from),
          messageId: message.id,
        })}`,
      );
      return;
    }

    const content = this.extractMessageContent(message);
    if (!content) {
      this.logger.warn(
        `WhatsApp incoming message ignored: unsupported content ${JSON.stringify({
          phoneNumberId,
          from: this.maskPhone(message.from),
          messageId: message.id,
          type: message.type,
        })}`,
      );
      return;
    }

    const contactName =
      contacts?.find((contact) => contact.wa_id === message.from)?.profile?.name ||
      message.from;
    const conversation = await this.findOrCreateConversation(channel, message.from, contactName);

    await this.messages.save(
      this.messages.create({
        content,
        senderType: 'customer',
        conversationId: conversation.id,
      }),
    );

    await this.conversations.update(
      { id: conversation.id },
      {
        updatedAt: new Date(),
        unreadCount: conversation.unreadCount + 1,
        status: conversation.status === 'closed' ? 'open' : conversation.status,
      },
    );

    const botReply = await this.getChatbotReply(channel.companyId, content);
    if (botReply) {
      await this.messages.save(
        this.messages.create({
          content: botReply,
          senderType: 'bot',
          conversationId: conversation.id,
        }),
      );

      try {
        await this.sendTextMessage(channel, message.from, botReply);
      } catch (error) {
        this.logger.warn(
          `WhatsApp bot reply send failed ${JSON.stringify({
            phoneNumberId,
            conversationId: conversation.id,
            message: error instanceof Error ? error.message : String(error),
          })}`,
        );
      }
    }

    this.logger.log(
      `WhatsApp incoming message stored ${JSON.stringify({
        phoneNumberId,
        conversationId: conversation.id,
        from: this.maskPhone(message.from),
        messageId: message.id,
      })}`,
    );
  }

  private extractMessageContent(message: WhatsAppIncomingMessage) {
    if (message.type === 'text' && message.text?.body) return message.text.body.trim();
    if (message.button?.text) return message.button.text.trim();
    if (message.interactive?.button_reply?.title) return message.interactive.button_reply.title.trim();
    if (message.interactive?.list_reply?.title) return message.interactive.list_reply.title.trim();
    return '';
  }

  private async findOrCreateConversation(channel: Channel, customerPhone: string, customerName: string) {
    const existing = await this.conversations.findOne({
      where: [
        { channelId: channel.id, customerPhone, status: In(['open', 'pending']) },
        { companyId: channel.companyId, channel: 'whatsapp', customerPhone, status: In(['open', 'pending']) },
      ],
      order: { updatedAt: 'DESC' },
    });
    if (existing) return existing;

    const agentId = await this.assignConversation(channel.companyId);
    return this.conversations.save(
      this.conversations.create({
        customerName,
        customerPhone,
        customerEmail: null,
        customerAvatar: null,
        channel: 'whatsapp',
        channelId: channel.id,
        companyId: channel.companyId,
        agentId,
        status: 'open',
      }),
    );
  }

  private async assignConversation(companyId: string) {
    const agents = await this.users.find({
      where: {
        companyId,
        role: In(['agent', 'company_admin']),
        online: true,
      },
      order: { createdAt: 'ASC' },
    });

    if (agents.length === 0) {
      const anyAgent = await this.users.findOne({
        where: { companyId, role: In(['agent', 'company_admin']) },
      });
      return anyAgent?.id || null;
    }

    const withCounts = await Promise.all(
      agents.map(async (agent) => ({
        id: agent.id,
        count: await this.conversations.count({
          where: { agentId: agent.id, status: In(['open', 'pending']) },
        }),
      })),
    );

    withCounts.sort((a, b) => a.count - b.count);
    return withCounts[0]?.id || null;
  }

  private async getChatbotReply(companyId: string, message: string) {
    const company = await this.companies.findOne({ where: { id: companyId } });
    if (!company) return null;

    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (currentTime < company.businessHoursStart || currentTime > company.businessHoursEnd) {
      return `Nosso horario de atendimento e das ${company.businessHoursStart} as ${company.businessHoursEnd}. Retornaremos em breve!`;
    }

    const rules = await this.chatbotRules.find({
      where: { companyId, active: true },
    });
    const lowerMsg = message.toLowerCase();

    for (const rule of rules) {
      const keywords = rule.keyword.toLowerCase().split(',').map((keyword) => keyword.trim());
      if (keywords.some((keyword) => keyword && lowerMsg.includes(keyword))) {
        return rule.response;
      }
    }

    return null;
  }

  private async resolveConversationChannel(conversation: Conversation) {
    if (conversation.channelId) {
      const channel = await this.channels.findOne({ where: { id: conversation.channelId } });
      if (channel) return channel;
    }

    const channel = await this.channels.findOne({
      where: { companyId: conversation.companyId, type: 'whatsapp', connected: true },
      order: { createdAt: 'ASC' },
    });

    if (!channel) throw new BadRequestException('WhatsApp channel is not configured');
    return channel;
  }

  private assertCanSend(channel: Channel) {
    if (!channel.accountId?.trim()) {
      throw new BadRequestException('WhatsApp phone number ID is not configured for this channel');
    }
    if (!this.resolveAccessToken(channel)) {
      throw new BadRequestException('WhatsApp access token is not configured for this channel');
    }
  }

  private async sendTextMessage(channel: Channel, to: string, content: string) {
    this.assertCanSend(channel);
    const apiVersion = this.config.get<string>('WHATSAPP_GRAPH_API_VERSION')?.trim() || 'v23.0';
    const url = `https://graph.facebook.com/${apiVersion}/${channel.accountId}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.resolveAccessToken(channel)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: this.normalizePhone(to),
        type: 'text',
        text: {
          body: content,
          preview_url: false,
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      this.logger.warn(
        `WhatsApp send failed ${JSON.stringify({
          phoneNumberId: channel.accountId,
          to: this.maskPhone(to),
          status: response.status,
          response: this.truncate(errorBody, 300),
        })}`,
      );
      throw new BadRequestException('WhatsApp message could not be sent');
    }

    this.logger.log(
      `WhatsApp text message sent ${JSON.stringify({
        phoneNumberId: channel.accountId,
        to: this.maskPhone(to),
      })}`,
    );
  }

  private resolveAccessToken(channel: Channel) {
    return channel.accessToken?.trim() || this.config.get<string>('WHATSAPP_ACCESS_TOKEN')?.trim() || '';
  }

  private normalizePhone(value: string) {
    return value.replace(/[^\d]/g, '');
  }

  private maskPhone(value?: string) {
    if (!value) return value;
    const digits = this.normalizePhone(value);
    if (digits.length <= 4) return `[phone:${digits.length}]`;
    return `${digits.slice(0, 2)}...${digits.slice(-4)}`;
  }

  private truncate(value: string, maxLength: number) {
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
  }
}
