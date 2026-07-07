import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { createId } from '../../common/id';
import { Conversation } from './conversation.entity';
import { User } from './user.entity';

@Entity({ name: 'Message' })
export class Message {
  @PrimaryColumn('text')
  id: string = createId();

  @Column('text')
  content!: string;

  @Column('text')
  senderType!: string;

  @Column({ type: 'text', nullable: true })
  senderId!: string | null;

  @ManyToOne(() => User, (user) => user.messages, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'senderId' })
  sender!: User | null;

  @Column('text')
  conversationId!: string;

  @ManyToOne(() => Conversation, (conversation) => conversation.messages, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'conversationId' })
  conversation!: Conversation;

  @Column({ type: 'boolean', default: false })
  read!: boolean;

  @CreateDateColumn({ type: 'timestamp', precision: 3 })
  createdAt!: Date;
}

