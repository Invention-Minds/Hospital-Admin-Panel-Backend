# Use the official Node.js 18 image as a base
FROM node:18

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install app dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Generate Prisma client with correct binary
RUN npx prisma generate

# Compile TypeScript code
RUN npm run build

# Reinstall bcrypt to ensure native bindings are compiled for Linux
RUN npm rebuild bcrypt --build-from-source

# Expose the port that the app runs on
EXPOSE 3000

# Start the application
CMD ["node", "dist/index.js"]
