import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { createId } from '../../common/id';
import { Company } from './company.entity';

@Entity({ name: 'QuickReply' })
export class QuickReply {
  @PrimaryColumn('text')
  id: string = createId();

  @Column('text')
  text!: string;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column('text')
  companyId!: string;

  @ManyToOne(() => Company, (company) => company.quickReplies, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'companyId' })
  company!: Company;

  @CreateDateColumn({ type: 'timestamp', precision: 3 })
  createdAt!: Date;
}

