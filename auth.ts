import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
  ],
  // Pure JWT sessions — no database adapter needed.
  // User ID, name, email, and image are persisted directly in the signed cookie.
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user, account, profile }) {
      // On first sign-in, persist Google's sub as the stable user id.
      if (user?.id)     token.sub   = user.id;
      if (user?.name)   token.name  = user.name;
      if (user?.email)  token.email = user.email;
      if (user?.image)  token.picture = user.image;
      // Also grab it from the Google profile directly if available
      if (profile?.sub) token.sub   = profile.sub;
      return token;
    },
    async session({ session, token }) {
      // Surface the stable id and profile on the client-side session object.
      if (token.sub)     session.user.id    = token.sub;
      if (token.name)    session.user.name  = token.name as string;
      if (token.email)   session.user.email = token.email as string;
      if (token.picture) session.user.image = token.picture as string;
      return session;
    },
  },
});

// Augment the default Session type to include user.id
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}
