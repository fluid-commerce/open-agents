type ResumableStreamContext = {
  createNewResumableStream: <T>(
    _streamId: string,
    streamFactory: () => ReadableStream<T>,
  ) => Promise<ReadableStream<T>>;
  resumeExistingStream: (_streamId: string) => Promise<null>;
};

export const resumableStreamContext: ResumableStreamContext = {
  createNewResumableStream: async (_streamId, streamFactory) => streamFactory(),
  resumeExistingStream: async () => null,
};
