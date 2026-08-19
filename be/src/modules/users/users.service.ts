import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOneBy({ email });
  }

  findByGoogleId(googleId: string): Promise<User | null> {
    return this.usersRepository.findOneBy({ googleId });
  }

  findById(id: string): Promise<User | null> {
    return this.usersRepository.findOneBy({ id });
  }

  create(data: Partial<User>): Promise<User> {
    const user = this.usersRepository.create(data);
    return this.usersRepository.save(user);
  }

  linkGoogleId(userId: string, googleId: string): Promise<User> {
    return this.usersRepository.save({ id: userId, googleId } as User);
  }

  updatePlan(userId: string, plan: 'free' | 'pro'): Promise<User> {
    return this.usersRepository.save({ id: userId, plan } as User);
  }
}