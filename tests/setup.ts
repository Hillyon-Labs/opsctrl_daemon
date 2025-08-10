global.fetch = jest.fn();

// Mock process.exit to prevent tests from terminating
const mockExit = jest.spyOn(process, 'exit').mockImplementation((() => {
  throw new Error('process.exit called');
}) as any);

beforeEach(() => {
  jest.clearAllMocks();
  mockExit.mockClear();
});