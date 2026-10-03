// Trusted lab test helper: only Java standard-library PRNG calls, no cheat code.
import java.util.Random;
import java.util.SplittableRandom;

public final class RngReference {
    public static void main(String[] args) {
        int[] bounds = {1, 2, 3, 7, 16, 48, 120, 2001, 60001, 1073741825, 2147483647};
        for (long seed : new long[] {0L, 1L, -1L, 421L, Long.MIN_VALUE, Long.MAX_VALUE}) {
            Random random = new Random(seed);
            SplittableRandom split = new SplittableRandom(seed);
            for (int step = 0; step < 100; step++) {
                int bound = bounds[step % bounds.length];
                System.out.println("random," + seed + "," + bound + "," + random.nextInt(bound)
                    + "," + random.nextInt() + "," + random.nextDouble());
                System.out.println("split," + seed + "," + bound + "," + split.nextInt(bound)
                    + "," + split.nextInt() + "," + split.nextDouble());
            }
        }
    }
}
