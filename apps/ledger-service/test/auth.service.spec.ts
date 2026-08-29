import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../src/auth/auth.service';
import { User } from '../src/auth/entities/user.entity';

describe('AuthService', () => {
  let service: AuthService;
  let usersRepo: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock };

  beforeEach(async () => {
    usersRepo = {
      findOne: jest.fn(),
      save: jest.fn(async (u) => ({ id: 'user-1', ...u })),
      create: jest.fn((u) => u),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: usersRepo },
        JwtService,
      ],
    }).compile();

    service = moduleRef.get(AuthService);
    process.env.JWT_ACCESS_SECRET = 'test-access';
    process.env.JWT_REFRESH_SECRET = 'test-refresh';
  });

  it('registers a new user and returns a token pair', async () => {
    usersRepo.findOne.mockResolvedValueOnce(null);
    const result = await service.register({
      email: 'new@example.com',
      password: 'password123',
    });
    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
  });

  it('rejects registration with an already-used email', async () => {
    usersRepo.findOne.mockResolvedValueOnce({ id: 'user-1' });
    await expect(
      service.register({ email: 'dup@example.com', password: 'password123' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects login with a wrong password', async () => {
    usersRepo.findOne.mockResolvedValueOnce({
      id: 'user-1',
      email: 'a@example.com',
      passwordHash: await bcrypt.hash('correct-password', 10),
    });
    await expect(
      service.login({ email: 'a@example.com', password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
