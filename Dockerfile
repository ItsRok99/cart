# Base image
FROM --platform=linux/amd64 node:14

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the app source code
COPY . .

# Expose the port that the app listens on
EXPOSE 3032

# Start the app
CMD ["node", "server.js"]