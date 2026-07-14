import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsDateString, IsInt, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';
import { MenusService } from './menus.service';
class CreateDishDto { @IsString() @Length(2,150) name!:string; @IsOptional() @IsString() description?:string; @IsOptional() @IsString() categoryCode?:string; @IsOptional() @IsString() imageUrl?:string; @IsInt() @Min(1) shelfLifeHours!:number; @IsNumber() @Min(0) estimatedCost!:number; @IsNumber() @Min(0.001) yieldQuantity!:number; @IsString() yieldUnit!:string; }
class CreateMenuDto { @IsString() cppCode!:string; @IsDateString() startsOn!:string; @IsDateString() endsOn!:string; @IsOptional() @IsDateString() orderCutoffAt?:string; @IsOptional() @IsString() message?:string; }
class AddMenuItemDto { @IsString() dishCode!:string; @IsDateString() serviceDate!:string; @IsString() presentationName!:string; @IsNumber() @Min(0) price!:number; @IsInt() @Min(0) capacity!:number; }
@Controller('menus')
export class MenusController {
 constructor(private readonly service:MenusService){}
 @Post('dishes') createDish(@Body() dto:CreateDishDto){ return this.service.createDish(dto); }
 @Post('weekly') createMenu(@Body() dto:CreateMenuDto){ return this.service.createMenu(dto); }
 @Post('weekly/:menuCode/items') addItem(@Param('menuCode') code:string,@Body() dto:AddMenuItemDto){ return this.service.addItem(code,dto); }
 @Post('weekly/:menuCode/publish') publish(@Param('menuCode') code:string){ return this.service.publish(code); }
 @Get('households/:haid/current') current(@Param('haid') haid:string){ return this.service.currentForHousehold(haid); }
}
