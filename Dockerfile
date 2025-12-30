FROM node:20-slim
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm ci --production
RUN npm cache clean --force
RUN npm run build
ENV NODE_ENV="production"
COPY . .
CMD [ "npm", "start" ]
