import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';
import {JwtService} from "@nestjs/jwt";

// Comparé contre un mot de passe inconnu quand aucun utilisateur n'est trouvé,
// pour que le coût bcrypt soit payé dans les deux branches : sinon l'écart de
// latence (email inconnu ~instantané vs mot de passe faux ~50ms) trahit
// l'existence d'un compte malgré un message d'erreur identique.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('no-such-user-timing-safety', 10);

@Injectable()
export class AuthService {
    constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService) {}

    async register(dto: RegisterDto) {
        const existingUser = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });
        if (existingUser) {
            throw new ConflictException('Email already in use');
        }

        const hashedPassword = await bcrypt.hash(dto.password, 10);

        const user = await this.prisma.user.create({
            data: {
                email: dto.email,
                passwordHash: hashedPassword,
                displayName: dto.displayName,
            },
        });

        const { passwordHash: _, ...safeUser } = user;

        return safeUser;
    }

    async login(dto: LoginDto) {
        const user = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });
        if (!user) {
            await bcrypt.compare(dto.password, DUMMY_PASSWORD_HASH);
            throw new UnauthorizedException('Invalid credentials');
        }

        const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
        if (!isPasswordValid) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const { passwordHash: _, ...safeUser } = user;

        const token = await this.jwt.signAsync({ userId: user.id });

        return { user: safeUser, token };
    }
}
