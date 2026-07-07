import { Column, Entity, PrimaryColumn } from 'typeorm';
import { createId } from '../../common/id';

@Entity({ name: 'Plan' })
export class Plan {
  @PrimaryColumn('text')
  id: string = createId();

  @Column('text')
  name!: string;

  @Column({ type: 'text', unique: true })
  slug!: string;

  @Column({ type: 'float8' })
  price!: number;

  @Column('integer')
  maxAgents!: number;

  @Column('integer')
  maxChannels!: number;

  @Column('integer')
  maxMessages!: number;

  @Column('text')
  features!: string;

  @Column({ type: 'text', nullable: true })
  stripePriceId!: string | null;
}

