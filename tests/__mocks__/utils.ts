export const printErrorAndExit = jest.fn().mockImplementation((message: string) => {
  throw new Error(message);
});

export const parseContainerState = jest.requireActual('../../src/utils/utils').parseContainerState;
export const verboseLogDiagnosis = jest.requireActual('../../src/utils/utils').verboseLogDiagnosis;
export const delay = jest.requireActual('../../src/utils/utils').delay;
export const waitUntil = jest.requireActual('../../src/utils/utils').waitUntil;
export const openBrowser = jest.requireActual('../../src/utils/utils').openBrowser;