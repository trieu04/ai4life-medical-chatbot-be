import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
  Sse,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
  ApiOperation,
  ApiParam,
} from "@nestjs/swagger";
import { Observable, from, map } from "rxjs";
import { plainToInstance } from "class-transformer";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { GetUserId } from "../../auth/decorators/get-user-id.decorator";
import { GetUser } from "../../auth/decorators/get-user.decorator";
import { ApiHttpException } from "../../../common/decorators/api-http-exception.decorator";
import { ChatService } from "../services/chat.service";
import { MessageService } from "../services/message.service";

import { CreateConversationDto } from "../dtos/create-conversation.dto";
import { SendMessageDto } from "../dtos/send-message.dto";
import { ConversationListDto } from "../dtos/conversation-list.dto";
import { SearchMessageDto } from "../dtos/search-message.dto";
import { ConversationDto } from "../dtos/conversation.dto";
import { MessageDto } from "../dtos/message.dto";

import { PaginatedResponse } from "../../../common/dtos/pagination.dto";
import { UserEntity } from "../../auth/entities/user.entity";

@ApiTags("Chat")
@Controller("chat")
@UsePipes(new ValidationPipe())
@UseInterceptors(ClassSerializerInterceptor)
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly messageService: MessageService,
  ) { }

  // ==================== Conversation Management ====================

  @Post("conversations")
  @ApiOperation({ summary: "Create a new conversation" })
  @ApiOkResponse({ type: ConversationDto })
  @ApiHttpException(() => [])
  @HttpCode(201)
  async createConversation(
    @GetUserId() userId: string,
    @Body() dto: CreateConversationDto,
  ): Promise<ConversationDto> {
    const conversation = await this.chatService.createConversation(userId, dto);
    return plainToInstance(ConversationDto, conversation);
  }

  @Get("conversations")
  @ApiOperation({ summary: "Get all conversations for the current user" })
  @ApiOkResponse({ type: ConversationDto, isArray: true })
  @ApiHttpException(() => [])
  async getConversations(
    @GetUserId() userId: string,
    @Query() query: ConversationListDto,
  ): Promise<PaginatedResponse<ConversationDto>> {
    const result = await this.chatService.getConversations(
      userId,
      query.page,
      query.limit,
      query.search,
    );

    return {
      items: plainToInstance(ConversationDto, result.items),
      pagination: result.pagination,
    };
  }

  @Get("conversations/:id")
  @ApiOperation({ summary: "Get a specific conversation with messages" })
  @ApiParam({ name: "id", description: "Conversation ID" })
  @ApiOkResponse({ type: ConversationDto })
  @ApiHttpException(() => [])
  async getConversation(
    @GetUserId() userId: string,
    @Param("id") id: string,
  ): Promise<ConversationDto> {
    const conversation = await this.chatService.getConversationById(id, userId);
    return plainToInstance(ConversationDto, conversation);
  }

  @Delete("conversations/:id")
  @ApiOperation({ summary: "Delete a conversation (soft delete)" })
  @ApiParam({ name: "id", description: "Conversation ID" })
  @ApiOkResponse({ description: "Conversation deleted successfully" })
  @ApiHttpException(() => [])
  @HttpCode(204)
  async deleteConversation(
    @GetUserId() userId: string,
    @Param("id") id: string,
  ): Promise<void> {
    await this.chatService.deleteConversation(id, userId);
  }

  // ==================== Start Conversation with First Message ====================

  @Post("conversations/start")
  @ApiOperation({ summary: "Start a new conversation with the first message" })
  @ApiOkResponse({ description: "Conversation created and first message processed" })
  @ApiHttpException(() => [])
  @HttpCode(201)
  async startConversation(
    @GetUserId() userId: string,
    @GetUser() user: UserEntity,
    @Body() dto: SendMessageDto,
  ): Promise<{
    conversation: ConversationDto;
    userMessage: MessageDto;
    assistantMessage: MessageDto;
  }> {
    const result = await this.messageService.sendFirstMessage(userId, dto.content, user.role ?? "");
    return {
      conversation: plainToInstance(ConversationDto, result.conversation),
      userMessage: plainToInstance(MessageDto, result.userMessage),
      assistantMessage: plainToInstance(MessageDto, result.assistantMessage),
    };
  }

  @Post("conversations/start/stream")
  @ApiOperation({ summary: "Start a new conversation with streaming first response" })
  @Sse("sse")
  async startConversationStream(
    @GetUserId() userId: string,
    @GetUser() user: UserEntity,
    @Body() dto: SendMessageDto,
  ): Promise<Observable<{ data: string }>> {
    const result = await this.messageService.sendFirstMessageStreaming(
      userId,
      dto.content,
      user.role ?? "",
    );

    // First, emit the conversation ID so client knows the new conversation
    const conversationId = result.conversation.id;

    return from(
      (async function* () {
        // Emit conversation info first
        yield JSON.stringify({
          type: "conversation",
          conversationId,
        });

        // Then stream the response chunks
        for await (const chunk of result.stream) {
          yield JSON.stringify(chunk);
        }
      })(),
    ).pipe(map(data => ({ data })));
  }

  // ==================== Message Management ====================

  @Get("conversations/:id/messages")
  @ApiOperation({ summary: "Get all messages in a conversation" })
  @ApiParam({ name: "id", description: "Conversation ID" })
  @ApiOkResponse({ type: MessageDto, isArray: true })
  @ApiHttpException(() => [])
  async getMessages(
    @GetUserId() userId: string,
    @Param("id") id: string,
  ): Promise<{ conversation: ConversationDto; messages: MessageDto[] }> {
    const result = await this.chatService.getConversationMessages(id, userId);
    return {
      conversation: plainToInstance(ConversationDto, result.conversation),
      messages: plainToInstance(MessageDto, result.messages),
    };
  }

  @Post("conversations/:id/messages")
  @ApiOperation({ summary: "Send a message in a conversation" })
  @ApiParam({ name: "id", description: "Conversation ID" })
  @ApiOkResponse({ type: MessageDto })
  @ApiHttpException(() => [])
  async sendMessage(
    @GetUserId() userId: string,
    @GetUser() user: UserEntity,
    @Param("id") conversationId: string,
    @Body() dto: SendMessageDto,
  ): Promise<{ userMessage: MessageDto; assistantMessage: MessageDto }> {
    const result = await this.messageService.sendMessage(
      conversationId,
      userId,
      dto,
      user.role ?? "",
    );

    return {
      userMessage: plainToInstance(MessageDto, result.userMessage),
      assistantMessage: plainToInstance(MessageDto, result.assistantMessage),
    };
  }

  @Post("conversations/:id/messages/stream")
  @ApiOperation({ summary: "Send a message with streaming response" })
  @ApiParam({ name: "id", description: "Conversation ID" })
  @Sse("sse")
  async sendMessageStreaming(
    @GetUserId() userId: string,
    @GetUser() user: UserEntity,
    @Param("id") conversationId: string,
    @Body() dto: SendMessageDto,
  ): Promise<Observable<{ data: string }>> {
    const result = await this.messageService.sendMessageStreaming(
      conversationId,
      userId,
      dto,
      user.role ?? "",
    );

    return from(
      (async function* () {
        for await (const chunk of result.stream) {
          yield JSON.stringify(chunk);
        }
      })(),
    ).pipe(map(data => ({ data })));
  }

  // ==================== Search ====================

  @Get("search/messages")
  @ApiOperation({ summary: "Search messages across conversations" })
  @ApiOkResponse({ type: MessageDto, isArray: true })
  @ApiHttpException(() => [])
  async searchMessages(
    @GetUserId() userId: string,
    @Query() query: SearchMessageDto,
  ): Promise<PaginatedResponse<MessageDto>> {
    const result = await this.messageService.searchMessages(
      userId,
      query.keyword,
      {
        conversationId: query.conversationId,
        startDate: query.startDate,
        endDate: query.endDate,
      },
      query.page,
      query.limit,
    );

    return {
      items: plainToInstance(MessageDto, result.items),
      pagination: result.pagination,
    };
  }
}
