import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'ChannelType' })
export class ChannelType {
  @PrimaryColumn('text')
  type!: string;

  @Column('text')
  label!: string;

  @Column('text')
  icon!: string;

  @Column('text')
  color!: string;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ type: 'integer', default: 0 })
  sortOrder!: number;
}

