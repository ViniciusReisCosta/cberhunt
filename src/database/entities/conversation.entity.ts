import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { createId } from '../../common/id';
import { Channel } from './channel.entity';
import { Company } from './company.entity';
import { ConversationTag } from './conversation-tag.entity';
import { Message } from './message.entity';
import { User } from './user.entity';

@Entity({ name: 'Conversation' })
export class Conversation {
  @PrimaryColumn('text')
  id: string = createId();

  @Column('text')
  customerName!: string;

  @Column({ type: 'text', nullable: true })
  customerEmail!: string | null;

  @Column({ type: 'text', nullable: true })
  customerPhone!: string | null;

  @Column({ type: 'text', nullable: true })
  customerAvatar!: string | null;

  @Column('text')
  channel!: string;

  @Column({ type: 'text', default: 'open' })
  status!: string;

  @Column({ type: 'integer', default: 0 })
  unreadCount!: number;

  @Column('text')
  companyId!: string;

  @ManyToOne(() => Company, (company) => company.conversations, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'companyId' })
  company!: Company;

  @Column({ type: 'text', nullable: true })
  channelId!: string | null;

  @ManyToOne(() => Channel, (channel) => channel.conversations, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'channelId' })
  channelRef!: Channel | null;

  @Column({ type: 'text', nullable: true })
  agentId!: string | null;

  @ManyToOne(() => User, (user) => user.assignedConversations, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'agentId' })
  agent!: User | null;

  @CreateDateColumn({ type: 'timestamp', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', precision: 3 })
  updatedAt!: Date;

  @OneToMany(() => Message, (message) => message.conversation)
  messages!: Message[];

  @OneToMany(() => ConversationTag, (tag) => tag.conversation)
  tags!: ConversationTag[];
}

