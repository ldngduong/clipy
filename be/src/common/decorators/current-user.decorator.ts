import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '../../modules/users/user.entity';

export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext): User | unknown => {
    const request = ctx.switchToHttp().getRequest();
    const user: User = request.user;
    return data ? user?.[data as keyof User] : user;
  },
);