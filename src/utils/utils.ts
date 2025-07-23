export function debounce<T extends (...args: any[]) => any>(
    func: T,
    delay: number
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
    let timeoutId: NodeJS.Timeout | null = null;
    let latestResolve: ((value: ReturnType<T>) => void) | null = null;
    let latestReject: ((reason?: any) => void) | null = null;

    return (...args: Parameters<T>): Promise<ReturnType<T>> => {
        return new Promise<ReturnType<T>>((resolve, reject) => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                if (latestReject) {
                    latestReject(new Error('Debounced call cancelled'));
                }
            }

            latestResolve = resolve;
            latestReject = reject;

            timeoutId = setTimeout(async () => {
                try {
                    const result = await func(...args);
                    if (latestResolve) {
                        latestResolve(result);
                    }
                } catch (error) {
                    if (latestReject) {
                        latestReject(error);
                    }
                }
                timeoutId = null;
                latestResolve = null;
                latestReject = null;
            }, delay);
        });
    };
}