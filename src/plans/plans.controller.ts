import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Plan } from '../database/entities/plan.entity';

@Controller('plans')
export class PlansController {
  constructor(
    @InjectRepository(Plan)
    private readonly plans: Repository<Plan>,
  ) {}

  @Get()
  findAll() {
    return this.plans.find({ order: { price: 'ASC' } });
  }
}

