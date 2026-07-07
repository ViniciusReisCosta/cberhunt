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

@Entity({ name: 'Invoice' })
export class Invoice {
  @PrimaryColumn('text')
  id: string = createId();

  @Column('text')
  companyId!: string;

  @ManyToOne(() => Company, (company) => company.invoices, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'companyId' })
  company!: Company;

  @Column({ type: 'text', nullable: true, unique: true })
  stripeInvoiceId!: string | null;

  @Column({ type: 'float8', default: 0 })
  amount!: number;

  @Column({ type: 'text', default: 'brl' })
  currency!: string;

  @Column({ type: 'text', default: 'pending' })
  status!: string;

  @Column({ type: 'text', nullable: true })
  hostedInvoiceUrl!: string | null;

  @CreateDateColumn({ type: 'timestamp', precision: 3 })
  createdAt!: Date;
}

