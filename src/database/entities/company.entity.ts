import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { createId } from '../../common/id';
import { User } from './user.entity';
import { Conversation } from './conversation.entity';
import { Channel } from './channel.entity';
import { ChatbotRule } from './chatbot-rule.entity';
import { QuickReply } from './quick-reply.entity';
import { NotificationPreference } from './notification-preference.entity';
import { ApiKey } from './api-key.entity';
import { Invoice } from './invoice.entity';

export enum PaymentStatus {
  Pending = 'pending',
  Paid = 'paid',
  Failed = 'failed',
  Canceled = 'canceled',
}

@Entity({ name: 'Company' })
export class Company {
  @PrimaryColumn('text')
  id: string = createId();

  @Column('text')
  name!: string;

  @Column({ type: 'text', unique: true })
  email!: string;

  @Column({ type: 'text', nullable: true })
  phone!: string | null;

  @Column({ type: 'text', nullable: true })
  address!: string | null;

  @Column({ type: 'text', default: 'starter' })
  plan!: string;

  @Column({ type: 'boolean', default: false })
  active!: boolean;

  @Column({ type: 'text', nullable: true, unique: true })
  stripeCustomerId!: string | null;

  @Column({ type: 'text', nullable: true, unique: true })
  stripeSubscriptionId!: string | null;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    enumName: 'PaymentStatus',
    default: PaymentStatus.Pending,
  })
  paymentStatus!: PaymentStatus;

  @Column({ type: 'text', default: '08:00' })
  businessHoursStart!: string;

  @Column({ type: 'text', default: '18:00' })
  businessHoursEnd!: string;

  @Column({ type: 'text', default: 'Ola! Como posso ajuda-lo?' })
  welcomeMessage!: string;

  @CreateDateColumn({ type: 'timestamp', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', precision: 3 })
  updatedAt!: Date;

  @OneToMany(() => User, (user) => user.company)
  users!: User[];

  @OneToMany(() => Conversation, (conversation) => conversation.company)
  conversations!: Conversation[];

  @OneToMany(() => Channel, (channel) => channel.company)
  channels!: Channel[];

  @OneToMany(() => ChatbotRule, (rule) => rule.company)
  chatbotRules!: ChatbotRule[];

  @OneToMany(() => QuickReply, (reply) => reply.company)
  quickReplies!: QuickReply[];

  @OneToMany(() => NotificationPreference, (preference) => preference.company)
  notificationPreferences!: NotificationPreference[];

  @OneToMany(() => ApiKey, (apiKey) => apiKey.company)
  apiKeys!: ApiKey[];

  @OneToMany(() => Invoice, (invoice) => invoice.company)
  invoices!: Invoice[];
}

