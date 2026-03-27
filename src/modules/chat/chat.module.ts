import { CacheModule } from "@nestjs/cache-manager";
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
import { ReferenceMetadataService } from "./services/reference-metadata.service";

// Controllers
import { ChatController } from "./controllers/chat.controller";
import { GuestChatController } from "./controllers/guest-chat.controller";
import { ReferenceController } from "./controllers/reference.controller";
import { RagDataSourceModule } from "./rag-data-source.module";

// Import auth module for guards
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [
    CacheModule.register(),
    RagDataSourceModule,
    TypeOrmModule.forFeature([
      ConversationEntity,
      MessageEntity,
      ConversationSummaryEntity,
      CitationEntity,
    ]),
    ConfigModule,
    AuthModule,
  ],
  controllers: [ChatController, GuestChatController, ReferenceController],
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
    ReferenceMetadataService,
  ],
  exports: [ChatService, MessageService],
})
export class ChatModule { }
