import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
} from 'typeorm';
import { createId } from '../../common/id';
import { Company } from './company.entity';
import { Conversation } from './conversation.entity';

@Entity({ name: 'Channel' })
export class Channel {
  @PrimaryColumn('text')
  id: string = createId();

  @Column('text')
  type!: string;

  @Column('text')
  name!: string;

  @Column({ type: 'text', nullable: true })
  accountId!: string | null;

  @Column({ type: 'text', nullable: true })
  accessToken!: string | null;

  @Column({ type: 'boolean', default: false })
  connected!: boolean;

  @Column('text')
  companyId!: string;

  @ManyToOne(() => Company, (company) => company.channels, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'companyId' })
  company!: Company;

  @CreateDateColumn({ type: 'timestamp', precision: 3 })
  createdAt!: Date;

  @OneToMany(() => Conversation, (conversation) => conversation.channelRef)
  conversations!: Conversation[];
}

