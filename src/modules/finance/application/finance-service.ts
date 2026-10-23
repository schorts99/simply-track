import type { EventBus } from "@schorts/shared-kernel/event-bus";
import { FinanceBook, type Command, type FinanceState } from "../domain/finance";

export interface FinanceRepository {
  load(): Promise<FinanceState>;
  save(state: FinanceState, events: ReturnType<FinanceBook["pullDomainEvents"]>): Promise<void>;
}

export class FinanceService {
  constructor(private readonly repository: FinanceRepository, private readonly events: EventBus) {}
  read() { return this.repository.load(); }
  async execute(command: Command) {
    const book = new FinanceBook(await this.repository.load());
    book.execute(command);
    const events = book.pullDomainEvents();
    await this.repository.save(book.toPrimitives(), events);
    await this.events.publishMany(events);
    return book.toPrimitives();
  }
}
