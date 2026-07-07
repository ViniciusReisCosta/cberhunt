import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { createId } from '../../common/id';
import { Company } from './company.entity';

@Entity({ name: 'NotificationPreference' })
export class NotificationPreference {
  @PrimaryColumn('text')
  id: string = createId();

  @Column({ type: 'text', unique: true })
  companyId!: string;

  @ManyToOne(() => Company, (company) => company.notificationPreferences, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'companyId' })
  company!: Company;

  @Column({ type: 'boolean', default: true })
  emailNotifications!: boolean;

  @Column({ type: 'boolean', default: true })
  browserNotifications!: boolean;

  @Column({ type: 'boolean', default: true })
  newMessageAlerts!: boolean;

  @Column({ type: 'boolean', default: true })
  assignmentAlerts!: boolean;

  @Column({ type: 'boolean', default: true })
  paymentReminders!: boolean;

  @UpdateDateColumn({ type: 'timestamp', precision: 3 })
  updatedAt!: Date;
}

