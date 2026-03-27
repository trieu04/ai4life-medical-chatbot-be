import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";

export const RAG_DATA_SOURCE = "RAG_DATA_SOURCE";

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: RAG_DATA_SOURCE,
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const ragDatabaseUrl = process.env.RAG_DATABASE_URL
          || process.env.DOCUMENT_DATABASE_URL
          || configService.get<string>("ragDatabase.url")
          || configService.get<string>("documentDatabase.url");

        if (!ragDatabaseUrl) {
          throw new Error(
            "Missing RAG database URL. Set RAG_DATABASE_URL.",
          );
        }

        const dataSource = new DataSource({
          type: "postgres",
          url: ragDatabaseUrl,
        });

        if (!dataSource.isInitialized) {
          await dataSource.initialize();
        }

        return dataSource;
      },
    },
  ],
  exports: [RAG_DATA_SOURCE],
})
export class RagDataSourceModule {}
