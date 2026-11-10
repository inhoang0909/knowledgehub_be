import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, Job, JobOptions } from 'bull';

@Injectable()
export class PgBossService {
  private readonly logger = new Logger(PgBossService.name);

  constructor(@InjectQueue('default') private readonly queue: Queue) {}

  async start(): Promise<void> {
    this.logger.log('Bull initialized');
  }

  async stop(): Promise<void> {
    try {
      await this.queue.pause(true);
      this.logger.log('Queue paused');
    } catch (error) {
      this.logger.error('Failed to pause queue', error);
    }
  }

  async sendJob<T = any>(
    jobName: string,
    data: T,
    options?: JobOptions,
  ): Promise<string | number | undefined> {
    const job = await this.queue.add(jobName, data, options);
    this.logger.log(`Job ${job.id} added to ${jobName}`);
    return job.id;
  }

  async work<T = any>(
    jobName: string,
    handler: (job: Job<T>) => Promise<void>,
  ): Promise<void> {
    // register a processor at runtime for the given job name
    this.queue.process(jobName, async (job: Job<T>) => {
      try {
        await handler(job);
      } catch (err) {
        this.logger.error(`Handler error for job ${jobName}`, err);
        throw err;
      }
    });
    this.logger.log(`Worker registered for ${jobName}`);
  }

  async getJobById(id: string | number) {
    return this.queue.getJob(id as any);
  }

  async cancel(id: string | number) {
    const job = await this.queue.getJob(id as any);
    if (job) await job.remove();
  }

  async resumeAll(): Promise<void> {
    await this.queue.resume();
  }
}