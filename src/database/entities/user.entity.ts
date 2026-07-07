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
import { Company } from './company.entity';
import { Conversation } from './conversation.entity';
import { Message } from './message.entity';

@Entity({ name: 'User' })
export class User {
  @PrimaryColumn('text')
  id: string = createId();

  @Column('text')
  name!: string;

  @Column({ type: 'text', unique: true })
  email!: string;

  @Column('text')
  password!: string;

  @Column({ type: 'text', default: 'agent' })
  role!: string;

  @Column({ type: 'text', nullable: true })
  avatar!: string | null;

  @Column({ type: 'boolean', default: false })
  online!: boolean;

  @Column({ type: 'text', nullable: true })
  companyId!: string | null;

  @ManyToOne(() => Company, (company) => company.users, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'companyId' })
  company!: Company | null;

  @CreateDateColumn({ type: 'timestamp', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', precision: 3 })
  updatedAt!: Date;

  @OneToMany(() => Conversation, (conversation) => conversation.agent)
  assignedConversations!: Conversation[];

  @OneToMany(() => Message, (message) => message.sender)
  messages!: Message[];
}

