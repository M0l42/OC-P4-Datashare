import {IsEmail, IsOptional, IsString, MaxLength, MinLength} from "class-validator";

export class LoginDto {
    @IsEmail()
    email: string;

    @IsString()
    password: string;
}