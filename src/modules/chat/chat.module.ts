import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";

// Entities
import { ConversationEntity } from "./entities/conversation.entity";
import { MessageEntity } from "./entities/message.entity";
import { ConversationSummaryEntity } from "./entities/conversation-summary.entity";
import { CitationEntity } from "./entities/citation.entity";

// Repositories
import { ConversationRepository } from "./repositories/conversation.repository";
import { MessageRepository } from "./repositories/message.repository";

// Services
import { AiProvider } from "./services/ai-provider.interface";
import { Ai4lifeAiProvider } from "./services/ai4life-ai.provider";
import { AiService } from "./services/ai.service";
import { ChatService } from "./services/chat.service";
import { MessageService } from "./services/message.service";

// Controllers
import { ChatController } from "./controllers/chat.controller";
import { GuestChatController } from "./controllers/guest-chat.controller";

// Import auth module for guards
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ConversationEntity,
      MessageEntity,
      ConversationSummaryEntity,
      CitationEntity,
    ]),
    ConfigModule,
    AuthModule,
  ],
  controllers: [ChatController, GuestChatController],
  providers: [
    ConversationRepository,
    MessageRepository,
    {
      provide: AiProvider,
      useClass: Ai4lifeAiProvider,
    },
    AiService,
    ChatService,
    MessageService,
  ],
  exports: [ChatService, MessageService],
})
export class ChatModule { }
