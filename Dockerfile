FROM fedora-minimal:rawhide
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN dnf in -y npm rpmspec
RUN npm ci --production
RUN npm cache clean --force
ENV NODE_ENV="production"
COPY . .
RUN npm i -g typescript && npm run build && npm uninstall -g typescript
CMD [ "npm", "start" ]
