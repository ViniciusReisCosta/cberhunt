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

@Entity({ name: 'ApiKey' })
export class ApiKey {
  @PrimaryColumn('text')
  id: string = createId();

  @Column('text')
  name!: string;

  @Column('text')
  keyPrefix!: string;

  @Column('text')
  keyHash!: string;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column('text')
  companyId!: string;

  @ManyToOne(() => Company, (company) => company.apiKeys, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'companyId' })
  company!: Company;

  @CreateDateColumn({ type: 'timestamp', precision: 3 })
  createdAt!: Date;

  @Column({ type: 'timestamp', precision: 3, nullable: true })
  lastUsedAt!: Date | null;

  @Column({ type: 'timestamp', precision: 3, nullable: true })
  revokedAt!: Date | null;
}

