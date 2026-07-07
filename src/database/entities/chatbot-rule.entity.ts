import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { createId } from '../../common/id';
import { Company } from './company.entity';

@Entity({ name: 'ChatbotRule' })
export class ChatbotRule {
  @PrimaryColumn('text')
  id: string = createId();

  @Column('text')
  keyword!: string;

  @Column('text')
  response!: string;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column('text')
  companyId!: string;

  @ManyToOne(() => Company, (company) => company.chatbotRules, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'companyId' })
  company!: Company;
}

