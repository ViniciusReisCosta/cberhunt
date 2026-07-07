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

@Entity({ name: 'ConversationTag' })
export class ConversationTag {
  @PrimaryColumn('text')
  id: string = createId();

  @Column('text')
  label!: string;

  @Column({ type: 'text', default: '#1273eb' })
  color!: string;

  @Column('text')
  conversationId!: string;

  @ManyToOne(() => Conversation, (conversation) => conversation.tags, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'conversationId' })
  conversation!: Conversation;

  @CreateDateColumn({ type: 'timestamp', precision: 3 })
  createdAt!: Date;
}

